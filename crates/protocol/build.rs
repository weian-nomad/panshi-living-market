use std::{env, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let proto_root = manifest_dir.join("../../contracts/proto");
    let sources = [
        proto_root.join("panshi/common/v1/envelope.proto"),
        proto_root.join("panshi/game/v1/desk.proto"),
        proto_root.join("panshi/game/v1/decision.proto"),
    ];

    for source in &sources {
        println!("cargo:rerun-if-changed={}", source.display());
    }

    let descriptor_path =
        PathBuf::from(env::var("OUT_DIR").expect("out dir")).join("panshi_descriptor.bin");
    let mut config = prost_build::Config::new();
    config.protoc_executable(
        protoc_bin_vendored::protoc_bin_path().expect("vendored protoc must match the host"),
    );
    config.file_descriptor_set_path(descriptor_path);
    config
        .compile_protos(&sources, &[proto_root])
        .expect("canonical protobuf contracts must compile");
}
