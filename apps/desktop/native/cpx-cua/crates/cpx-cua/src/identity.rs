//! Windows trust verification adapted from Microsoft Windows-classic-samples
//! Samples/Security/CodeSigning/cpp/codesigning.cpp (MIT).
//! Copyright (c) Microsoft Corporation. All rights reserved.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom},
    mem::size_of,
    os::windows::{fs::OpenOptionsExt, io::AsRawHandle},
};
use windows::{
    core::{HSTRING, PCWSTR, PWSTR},
    Management::Deployment::PackageManager,
    Win32::{
        Foundation::{CloseHandle, FILETIME, HANDLE, HWND},
        Security::{
            Cryptography::{Catalog::*, CertNameToStrW, CERT_X500_NAME_STR, X509_ASN_ENCODING},
            WinTrust::*,
        },
        Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW},
        System::{
            Threading::*,
            WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
        },
        UI::WindowsAndMessaging::{GetWindowThreadProcessId, IsWindow},
    },
};

#[link(name = "kernel32")]
extern "system" {
    fn GetApplicationUserModelId(process: HANDLE, length: *mut u32, id: *mut u16) -> i32;
    fn GetPackageFullName(process: HANDLE, length: *mut u32, name: *mut u16) -> i32;
}
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
fn text(value: &[u16]) -> String {
    String::from_utf16_lossy(&value[..value.iter().position(|x| *x == 0).unwrap_or(value.len())])
}
fn digest(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}
fn app_id(fields: Value) -> String {
    format!("cpx2:{}", digest(fields.to_string().as_bytes()))
}
fn canonical(path: &str) -> Option<String> {
    Some(
        std::fs::canonicalize(path)
            .ok()?
            .to_string_lossy()
            .trim_start_matches(r"\\?\")
            .to_lowercase(),
    )
}

// A damaged embedded signature must never fall back to an unsigned grant.
fn certificate_present(file: &mut File) -> Result<bool, ()> {
    let mut dos = [0u8; 64];
    file.seek(SeekFrom::Start(0)).map_err(|_| ())?;
    file.read_exact(&mut dos).map_err(|_| ())?;
    if &dos[..2] != b"MZ" {
        return Err(());
    }
    let offset = u32::from_le_bytes(dos[60..64].try_into().unwrap()) as u64;
    file.seek(SeekFrom::Start(offset)).map_err(|_| ())?;
    let mut header = [0u8; 26];
    file.read_exact(&mut header).map_err(|_| ())?;
    if &header[..4] != b"PE\0\0" {
        return Err(());
    }
    let directory = match u16::from_le_bytes(header[24..26].try_into().unwrap()) {
        0x10b => 96,
        0x20b => 112,
        _ => return Err(()),
    };
    file.seek(SeekFrom::Start(offset + 24 + directory + 4 * 8))
        .map_err(|_| ())?;
    let mut entry = [0u8; 8];
    file.read_exact(&mut entry).map_err(|_| ())?;
    file.seek(SeekFrom::Start(0)).map_err(|_| ())?;
    Ok(entry.iter().any(|byte| *byte != 0))
}

/// Returns the verified signer's X.500 subject, and always releases WinTrust state.
unsafe fn verify(data: &mut WINTRUST_DATA) -> Result<String, i32> {
    data.cbStruct = size_of::<WINTRUST_DATA>() as u32;
    data.dwUIChoice = WTD_UI_NONE;
    data.dwStateAction = WTD_STATEACTION_VERIFY;
    data.dwProvFlags = WTD_CACHE_ONLY_URL_RETRIEVAL;
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    let status = WinVerifyTrust(HWND::default(), &mut action, data as *mut _ as _);
    let result = if status != 0 {
        Err(status)
    } else {
        (|| {
            let provider = WTHelperProvDataFromStateData(data.hWVTStateData);
            if provider.is_null() {
                return Err(-1);
            }
            let signer = WTHelperGetProvSignerFromChain(provider, 0, false, 0);
            if signer.is_null() || (*signer).csCertChain == 0 || (*signer).pasCertChain.is_null() {
                return Err(-1);
            }
            let certificate = (*(*signer).pasCertChain).pCert;
            if certificate.is_null() || (*certificate).pCertInfo.is_null() {
                return Err(-1);
            }
            let subject = &(*(*certificate).pCertInfo).Subject;
            let length = CertNameToStrW(X509_ASN_ENCODING, subject, CERT_X500_NAME_STR, None);
            if length <= 1 {
                return Err(-1);
            }
            let mut buffer = vec![0; length as usize];
            if CertNameToStrW(
                X509_ASN_ENCODING,
                subject,
                CERT_X500_NAME_STR,
                Some(&mut buffer),
            ) == 0
            {
                return Err(-1);
            }
            Ok(text(&buffer))
        })()
    };
    data.dwStateAction = WTD_STATEACTION_CLOSE;
    WinVerifyTrust(HWND::default(), &mut action, data as *mut _ as _);
    result
}

unsafe fn publisher(path: &[u16], file: HANDLE, embedded: bool) -> Result<Option<String>, ()> {
    let mut info = WINTRUST_FILE_INFO {
        cbStruct: size_of::<WINTRUST_FILE_INFO>() as u32,
        pcwszFilePath: PCWSTR(path.as_ptr()),
        hFile: file,
        ..Default::default()
    };
    let mut data = WINTRUST_DATA {
        dwUnionChoice: WTD_CHOICE_FILE,
        Anonymous: WINTRUST_DATA_0 { pFile: &mut info },
        ..Default::default()
    };
    let mut signatures = WINTRUST_SIGNATURE_SETTINGS {
        cbStruct: size_of::<WINTRUST_SIGNATURE_SETTINGS>() as u32,
        dwFlags: WINTRUST_SIGNATURE_SETTINGS_FLAGS(
            WSS_GET_SECONDARY_SIG_COUNT.0 | WSS_VERIFY_SPECIFIC.0,
        ),
        ..Default::default()
    };
    data.pSignatureSettings = &mut signatures;
    match verify(&mut data) {
        Ok(publisher) => {
            let count = signatures.cSecondarySigs;
            for index in 1..=count {
                signatures.dwIndex = index;
                signatures.dwFlags = WSS_VERIFY_SPECIFIC;
                data.pSignatureSettings = &mut signatures;
                data.hWVTStateData = HANDLE::default();
                if verify(&mut data).map_err(|_| ())? != publisher {
                    return Err(());
                }
            }
            return Ok(Some(publisher));
        }
        // Only genuinely absent signatures can become unsigned.
        Err(status) if status as u32 == 0x800b0100 && !embedded => {}
        Err(_) => return Err(()),
    }
    let mut publishers = Vec::new();
    for algorithm in ["SHA256", "SHA1"] {
        let algorithm = wide(algorithm);
        let mut admin = 0;
        CryptCATAdminAcquireContext2(&mut admin, None, PCWSTR(algorithm.as_ptr()), None, 0)
            .map_err(|_| ())?;
        let result = (|| {
            let mut length = 0;
            CryptCATAdminCalcHashFromFileHandle2(admin, file, &mut length, None, 0)
                .map_err(|_| ())?;
            let mut hash = vec![0u8; length as usize];
            CryptCATAdminCalcHashFromFileHandle2(
                admin,
                file,
                &mut length,
                Some(hash.as_mut_ptr()),
                0,
            )
            .map_err(|_| ())?;
            let tag = wide(&hash.iter().map(|b| format!("{b:02X}")).collect::<String>());
            let mut previous = 0;
            loop {
                let catalog =
                    CryptCATAdminEnumCatalogFromHash(admin, &hash, 0, Some(&mut previous));
                if catalog == 0 {
                    break;
                }
                previous = catalog;
                let mut catalog_info = CATALOG_INFO {
                    cbStruct: size_of::<CATALOG_INFO>() as u32,
                    ..Default::default()
                };
                CryptCATCatalogInfoFromContext(catalog, &mut catalog_info, 0).map_err(|_| ())?;
                let mut info = WINTRUST_CATALOG_INFO {
                    cbStruct: size_of::<WINTRUST_CATALOG_INFO>() as u32,
                    pcwszCatalogFilePath: PCWSTR(catalog_info.wszCatalogFile.as_ptr()),
                    pcwszMemberTag: PCWSTR(tag.as_ptr()),
                    pcwszMemberFilePath: PCWSTR(path.as_ptr()),
                    hMemberFile: file,
                    pbCalculatedFileHash: hash.as_mut_ptr(),
                    cbCalculatedFileHash: length,
                    hCatAdmin: admin,
                    ..Default::default()
                };
                let mut data = WINTRUST_DATA {
                    dwUnionChoice: WTD_CHOICE_CATALOG,
                    Anonymous: WINTRUST_DATA_0 {
                        pCatalog: &mut info,
                    },
                    ..Default::default()
                };
                match verify(&mut data) {
                    Ok(value) => publishers.push(value),
                    Err(_) => {
                        let _ = CryptCATAdminReleaseCatalogContext(admin, catalog, 0);
                        return Err(());
                    }
                }
            }
            Ok(())
        })();
        let _ = CryptCATAdminReleaseContext(admin, 0);
        result?;
    }
    publishers.sort();
    publishers.dedup();
    match publishers.len() {
        0 => Ok(None),
        1 => Ok(publishers.pop()),
        _ => Err(()),
    }
}

unsafe fn version_identity(path: &[u16]) -> Option<(String, Option<String>)> {
    let size = GetFileVersionInfoSizeW(PCWSTR(path.as_ptr()), None);
    if size == 0 {
        return None;
    }
    let mut bytes = vec![0u8; size as usize];
    GetFileVersionInfoW(PCWSTR(path.as_ptr()), 0, size, bytes.as_mut_ptr() as _).ok()?;
    let query = |key: &str| -> Option<(*mut std::ffi::c_void, u32)> {
        let key = wide(key);
        let mut value = std::ptr::null_mut();
        let mut length = 0;
        if !VerQueryValueW(
            bytes.as_ptr() as _,
            PCWSTR(key.as_ptr()),
            &mut value,
            &mut length,
        )
        .as_bool()
            || value.is_null()
        {
            return None;
        }
        Some((value, length))
    };
    let (translations, count) = query(r"\VarFileInfo\Translation")?;
    let translations = std::slice::from_raw_parts(translations as *const u16, count as usize / 2);
    let mut versions = Vec::new();
    for pair in translations.chunks_exact(2) {
        let get = |field: &str| -> Option<String> {
            let (value, length) = query(&format!(
                "\\StringFileInfo\\{:04x}{:04x}\\{}",
                pair[0], pair[1], field
            ))?;
            let result = text(std::slice::from_raw_parts(
                value as *const u16,
                length as usize,
            ));
            if result.is_empty() {
                None
            } else {
                Some(result)
            }
        };
        versions.push((
            get("ProductName")?,
            get("OriginalFilename").map(|s| s.to_lowercase()),
        ));
    }
    versions.sort();
    versions.dedup();
    if versions.len() == 1 {
        versions.pop()
    } else {
        None
    }
}

unsafe fn package_identity(process: HANDLE, path: &str) -> Result<Option<String>, ()> {
    let mut length = 0;
    let code = GetPackageFullName(process, &mut length, std::ptr::null_mut());
    if code == 15700 {
        return Ok(None);
    } // APPMODEL_ERROR_NO_PACKAGE
    if code != 122 || length == 0 {
        return Err(());
    }
    let mut name = vec![0; length as usize];
    if GetPackageFullName(process, &mut length, name.as_mut_ptr()) != 0 {
        return Err(());
    }
    let mut length = 0;
    GetApplicationUserModelId(process, &mut length, std::ptr::null_mut());
    if length == 0 {
        return Err(());
    }
    let mut id = vec![0; length as usize];
    if GetApplicationUserModelId(process, &mut length, id.as_mut_ptr()) != 0 {
        return Err(());
    }
    let aumid = text(&id);
    let initialized = RoInitialize(RO_INIT_MULTITHREADED).is_ok();
    let result = (|| {
        let manager = PackageManager::new().map_err(|_| ())?;
        let package = manager
            .FindPackageByUserSecurityIdPackageFullName(
                &HSTRING::new(),
                &HSTRING::from(text(&name)),
            )
            .map_err(|_| ())?;
        if !package
            .Status()
            .map_err(|_| ())?
            .VerifyIsOK()
            .map_err(|_| ())?
        {
            return Err(());
        }
        if package.SignatureKind().map_err(|_| ())?
            == windows::ApplicationModel::PackageSignatureKind::None
        {
            return Err(());
        }
        let location = package
            .InstalledLocation()
            .map_err(|_| ())?
            .Path()
            .map_err(|_| ())?;
        let root = canonical(&location.to_string()).ok_or(())?;
        if !path.starts_with(&(root + "\\")) {
            return Err(());
        }
        let entries = package
            .GetAppListEntriesAsync()
            .map_err(|_| ())?
            .get()
            .map_err(|_| ())?;
        for entry in entries {
            if entry.AppUserModelId().map_err(|_| ())?.to_string() == aumid {
                return Ok(Some(aumid));
            }
        }
        Err(())
    })();
    if initialized {
        RoUninitialize()
    }
    result
}

pub fn identity(pid: u32) -> Option<(String, String, Value)> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let result = (|| {
            let mut created = FILETIME::default();
            let mut exited = FILETIME::default();
            let mut kernel = FILETIME::default();
            let mut user = FILETIME::default();
            GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user).ok()?;
            let process_key = format!("{}:{}", created.dwHighDateTime, created.dwLowDateTime);
            let mut buffer = vec![0; 32768];
            let mut size = buffer.len() as u32;
            QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                PWSTR(buffer.as_mut_ptr()),
                &mut size,
            )
            .ok()?;
            let path = canonical(&String::from_utf16_lossy(&buffer[..size as usize]))?;
            let legacy = format!("exe:{path}");
            let verified = (|| -> Result<(String, Value), ()> {
                // Hold the executable against writes/replacement throughout verification.
                let mut file = OpenOptions::new()
                    .read(true)
                    .share_mode(1)
                    .open(&path)
                    .map_err(|_| ())?;
                let embedded = certificate_present(&mut file)?;
                let mut hasher = Sha256::new();
                let mut chunk = [0u8; 65536];
                loop {
                    let count = file.read(&mut chunk).map_err(|_| ())?;
                    if count == 0 {
                        break;
                    }
                    hasher.update(&chunk[..count]);
                }
                let fingerprint = format!("{:x}", hasher.finalize());
                if let Some(aumid) = package_identity(handle, &path)? {
                    return Ok((
                        app_id(json!(["packaged", aumid])),
                        json!({"kind":"packaged","fingerprint":fingerprint,"legacyAppId":format!("aumid:{aumid}"),"aumid":aumid}),
                    ));
                }
                match publisher(&wide(&path), HANDLE(file.as_raw_handle()), embedded)? {
                    Some(publisher) => {
                        let (product, binary) = version_identity(&wide(&path)).ok_or(())?;
                        Ok((
                            app_id(json!(["signed", publisher, product, binary])),
                            json!({"kind":"signed","fingerprint":fingerprint,"legacyAppId":legacy,"publisher":publisher,"product":product,"binary":binary.clone().unwrap_or_default()}),
                        ))
                    }
                    None => Ok((
                        app_id(json!(["unsigned", fingerprint])),
                        json!({"kind":"unsigned","fingerprint":fingerprint,"sha256":fingerprint,"legacyAppId":legacy}),
                    )),
                }
            })();
            let (id, identity) = verified.unwrap_or_else(|_| {
                (
                    app_id(json!(["invalid", path])),
                    json!({"kind":"invalid","fingerprint":"","legacyAppId":legacy}),
                )
            });
            Some((id, process_key, identity))
        })();
        let _ = CloseHandle(handle);
        result
    }
}

pub fn window_matches(pid: u32, hwnd: isize) -> bool {
    unsafe {
        let window = HWND(hwnd as _);
        let mut owner = 0;
        IsWindow(window).as_bool()
            && GetWindowThreadProcessId(window, Some(&mut owner)) != 0
            && owner == pid
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unsigned_runtime_has_file_bound_identity() {
        let (_, _, value) = identity(std::process::id()).expect("Own process identity");
        assert_eq!(value["kind"], "unsigned");
        assert_eq!(value["sha256"], value["fingerprint"]);
        assert_eq!(value["fingerprint"].as_str().unwrap().len(), 64);
    }
    #[test]
    fn windows_catalog_signature_and_version_are_verified() {
        let root = std::env::var("SystemRoot").unwrap();
        let path = format!("{root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
        let mut file = OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&path)
            .unwrap();
        let embedded = certificate_present(&mut file).unwrap();
        assert!(
            !embedded,
            "Windows PowerShell is verified through its system catalog"
        );
        unsafe {
            assert!(
                publisher(&wide(&path), HANDLE(file.as_raw_handle()), embedded)
                    .unwrap()
                    .is_some()
            );
            assert!(version_identity(&wide(&path)).is_some());
        }
    }
    #[test]
    fn installed_embedded_signature_and_version_are_verified() {
        // This integration fixture uses an existing signed browser, never launches it.
        let candidates = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        ];
        let Some(path) = candidates
            .iter()
            .find(|path| std::path::Path::new(path).exists())
        else {
            return;
        };
        let mut file = OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(path)
            .unwrap();
        assert!(certificate_present(&mut file).unwrap());
        unsafe {
            assert!(publisher(&wide(path), HANDLE(file.as_raw_handle()), true)
                .unwrap()
                .is_some());
            assert!(version_identity(&wide(path)).is_some());
        }
    }
    #[test]
    fn embedded_signature_failure_cannot_become_unsigned() {
        let path = std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let file = File::open(&path).unwrap();
        unsafe {
            assert!(publisher(&wide(&path), HANDLE(file.as_raw_handle()), true).is_err());
        }
    }
    #[test]
    fn reused_or_missing_window_is_rejected() {
        assert!(!window_matches(std::process::id(), 0));
    }
}
