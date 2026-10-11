//! CPX-owned stdio host. Native capture/input and MCP dispatch are reused from Cua.
use cua_driver_core::{mcp_wire::ProtocolSession, protocol::{Request, Response}, server::{handle_request_with_transport_session, ToolProvider}, tool::ToolRegistry};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
mod identity;
use identity::identity;

const ALLOWED: &[&str] = &["get_window_state", "click", "double_click", "right_click", "type_text", "press_key", "hotkey", "scroll", "drag", "start_session", "end_session"];

struct CpxProvider { registry: ToolRegistry }
#[async_trait::async_trait]
impl ToolProvider for CpxProvider {
    fn tools_list(&self) -> Value {
        let mut list = self.registry.tools_list();
        if let Some(tools) = list["tools"].as_array_mut() {
            tools.retain(|tool| ALLOWED.contains(&tool["name"].as_str().unwrap_or("")));
            for tool in tools.iter_mut() {
                if !matches!(tool["name"].as_str(), Some("start_session" | "end_session")) {
                    tool["inputSchema"]["properties"]["cpx_app_id"] = json!({"type":"string"});
                    tool["inputSchema"]["properties"]["cpx_process_key"] = json!({"type":"string"});
                    tool["inputSchema"]["properties"]["cpx_fingerprint"] = json!({"type":"string"});
                    tool["inputSchema"]["properties"]["cpx_window_id"] = json!({"type":"string"});
                }
            }
            tools.push(json!({"name":"cpx_apps","x-cpx-identity-v1":true,"description":"Running Windows windows and host-derived identities","inputSchema":{"type":"object","properties":{},"additionalProperties":false}}));
        }
        list
    }
    async fn invoke_tool(&self, name: &str, mut args: Value) -> Result<Value, String> {
        if name == "cpx_apps" {
            let windows = tokio::task::spawn_blocking(|| {
                let mut identities = std::collections::HashMap::new();
                platform_windows::win32::list_windows(None).into_iter().filter_map(|window| {
                    let (app_id, process_key, trusted) = identities.entry(window.pid).or_insert_with(|| identity(window.pid)).clone()?;
                    Some(json!({"appId":app_id,"identity":trusted,"processKey":process_key,"pid":window.pid,"windowId":window.hwnd.to_string(),"name":window.title}))
                }).collect::<Vec<_>>()
            }).await.map_err(|_| "Application discovery failed")?;
            return Ok(json!({"content":[],"structuredContent":{"windows":windows}}));
        }
        if !ALLOWED.contains(&name) { return Err("Unsupported CPX-CUA tool".into()); }
        if !matches!(name, "start_session" | "end_session") {
            let pid = args["pid"].as_u64().and_then(|pid| u32::try_from(pid).ok()).ok_or("Missing target")?;
            let current = identity(pid).ok_or("Target exited")?;
            if current.2["kind"] == "invalid" || args["cpx_app_id"].as_str() != Some(&current.0) || args["cpx_process_key"].as_str() != Some(&current.1) || args["cpx_fingerprint"] != current.2["fingerprint"] || !args["cpx_window_id"].as_str().and_then(|id| id.parse::<isize>().ok()).is_some_and(|hwnd| identity::window_matches(pid, hwnd)) {
                return Err("Target identity changed; observe again".into());
            }
            let object = args.as_object_mut().ok_or("Invalid arguments")?;
            object.remove("cpx_app_id"); object.remove("cpx_process_key"); object.remove("cpx_fingerprint"); object.remove("cpx_window_id");
        }
        serde_json::to_value(self.registry.invoke_from_trusted_adapter(name, args).await).map_err(|_| "Result encoding failed".into())
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut registry = platform_windows::register_tools();
    registry.register_session_tools();
    let provider = CpxProvider { registry };
    let mut protocol = ProtocolSession::default();
    let mut reader = BufReader::new(tokio::io::stdin());
    let mut writer = tokio::io::BufWriter::new(tokio::io::stdout());
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line).await? == 0 { break; }
        if line.trim().is_empty() { continue; }
        let response = match serde_json::from_str::<Request>(&line) {
            Err(_) => Response::parse_error(),
            Ok(request) if request.is_notification() => continue,
            Ok(request) => match protocol.validate(&request) {
                Err(response) => response,
                Ok(_) => { let id = request.id.clone().unwrap_or(Value::Null); handle_request_with_transport_session(request, id, &provider, "cpx-cua").await }
            }
        };
        let mut response = serde_json::to_value(response)?;
        if response["result"]["serverInfo"].is_object() {
            response["result"]["serverInfo"] = json!({"name":"CPX-CUA","version":env!("CARGO_PKG_VERSION")});
            response["result"]["instructions"] = json!("CPX-CUA Windows runtime. Application authorization and control ownership belong to Pidex.");
        }
        writer.write_all(serde_json::to_string(&response)?.as_bytes()).await?;
        writer.write_all(b"\n").await?;
        writer.flush().await?;
    }
    Ok(())
}
