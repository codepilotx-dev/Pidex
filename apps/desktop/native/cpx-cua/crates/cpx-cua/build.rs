fn main() {
    #[cfg(windows)]
    embed_resource::compile("cpx-cua.rc", embed_resource::NONE);
}
