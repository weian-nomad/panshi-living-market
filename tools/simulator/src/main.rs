#![forbid(unsafe_code)]

use std::{env, fs, io::Write as _, path::PathBuf};

use panshi_simulator::sealed_episode_001;

fn main() {
    let fixture = sealed_episode_001();
    let args: Vec<String> = env::args().collect();
    if args.get(1).map(String::as_str) == Some("--emit-output") {
        std::io::stdout()
            .write_all(&fixture.output_bytes)
            .expect("write canonical output bytes");
        return;
    }
    if args.get(1).map(String::as_str) == Some("--write-golden") {
        let directory = args.get(2).map_or_else(
            || PathBuf::from("fixtures/historical/episode-001"),
            PathBuf::from,
        );
        fs::create_dir_all(&directory).expect("create fixture directory");
        fs::write(directory.join("input.pb"), &fixture.input_bytes).expect("write input golden");
        fs::write(directory.join("output.pb"), &fixture.output_bytes).expect("write output golden");
    }

    println!("input_digest={}", hex(&fixture.input_digest));
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        value.push(char::from(DIGITS[usize::from(byte >> 4)]));
        value.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    value
}
