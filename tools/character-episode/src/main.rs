#![forbid(unsafe_code)]

use std::{env, fs, io::Write as _, path::PathBuf};

use panshi_character_episode::{
    golden_episode, public_api::public_api_documents, slice::one_character_slice,
};

fn main() {
    let episode = golden_episode();
    let args: Vec<String> = env::args().collect();

    // The public read-side projection: the same canonical log, folded into
    // the five `contracts/openapi/public-v2.yaml` response objects and
    // written out at the relative path each one's route maps to, plus a
    // route index the dev middleware reads. Writes only; it never touches
    // the event fixtures above.
    if args.get(1).map(String::as_str) == Some("--write-public-api") {
        let slice = one_character_slice();
        let directory = args
            .get(2)
            .map_or_else(|| PathBuf::from("fixtures/v5/one-character-slice/api"), PathBuf::from);
        let documents = public_api_documents(&slice);
        for (relative_path, json) in &documents {
            let path = directory.join(relative_path);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).expect("create public api fixture directory");
            }
            fs::write(&path, json).expect("write public api document");
        }
        println!(
            "wrote {} public-v2 documents to {}",
            documents.len(),
            directory.display()
        );
        return;
    }

    // The one-character vertical slice (thirty sessions) writes to its own
    // directory and never touches the frozen golden fixture above.
    if args.get(1).map(String::as_str) == Some("--write-slice-events") {
        let slice = one_character_slice();
        let directory = args
            .get(2)
            .map_or_else(|| PathBuf::from("fixtures/v5/one-character-slice/events"), PathBuf::from);
        fs::create_dir_all(&directory).expect("create slice fixture directory");
        for (index, event) in slice.events.iter().enumerate() {
            // Three digits: thirty sessions emit several hundred events, and
            // the file names must still sort lexicographically in emission
            // order.
            let file_name = format!("{index:03}-{}.pb", event.event_type);
            fs::write(directory.join(file_name), &event.payload_bytes)
                .expect("write slice event payload");
        }
        let manifest = build_slice_manifest_json(&slice);
        fs::write(directory.join("manifest.json"), manifest).expect("write slice manifest");
        println!(
            "wrote {} canonical event payloads to {}",
            slice.events.len(),
            directory.display()
        );
        return;
    }

    if args.get(1).map(String::as_str) == Some("--emit-events") {
        // Concatenates every canonical event payload in fixed emission
        // order, length-framed so a byte-identical concatenation can be
        // compared across native and WASI builds without needing a shared
        // parser on the comparing side.
        let mut out = std::io::stdout();
        for event in &episode.events {
            let length = u64::try_from(event.payload_bytes.len())
                .expect("fixture payload fits u64")
                .to_be_bytes();
            out.write_all(&length).expect("write length frame");
            out.write_all(&event.payload_bytes).expect("write payload");
        }
        return;
    }

    if args.get(1).map(String::as_str) == Some("--write-golden") {
        let directory = args
            .get(2)
            .map_or_else(|| PathBuf::from("fixtures/v5/character-episode-001"), PathBuf::from);
        fs::create_dir_all(&directory).expect("create fixture directory");
        for (index, event) in episode.events.iter().enumerate() {
            let file_name = format!("{index:02}-{}.pb", event.event_type);
            fs::write(directory.join(file_name), &event.payload_bytes)
                .expect("write event payload golden");
        }
        let manifest = build_manifest_json(&episode);
        fs::write(directory.join("manifest.json"), manifest).expect("write manifest");
        println!("wrote {} canonical event payloads to {}", episode.events.len(), directory.display());
        return;
    }

    println!("events={}", episode.events.len());
    for event in &episode.events {
        println!(
            "  {:>2} {:<32} stream={:<16} digest={}",
            episode.events.iter().position(|candidate| std::ptr::eq(candidate, event)).unwrap_or(0),
            event.event_type,
            event.stream_type,
            hex(&event.payload_digest)
        );
    }
}

fn build_slice_manifest_json(slice: &panshi_character_episode::slice::CharacterSlice) -> String {
    use std::fmt::Write as _;
    let mut out = String::new();
    out.push_str("{\n  \"fixtureId\": \"v5-one-character-slice\",\n  \"sealed\": true,\n  \"events\": [\n");
    for (index, event) in slice.events.iter().enumerate() {
        let _ = writeln!(
            out,
            "    {{ \"index\": {index}, \"eventType\": \"{}\", \"streamType\": \"{}\", \"streamIdHex\": \"{}\", \"payloadSha256\": \"{}\", \"file\": \"{:03}-{}.pb\" }}{}",
            event.event_type,
            event.stream_type,
            hex(&event.stream_id),
            hex(&event.payload_digest),
            index,
            event.event_type,
            if index + 1 == slice.events.len() { "" } else { "," }
        );
    }
    out.push_str("  ]\n}\n");
    out
}

fn build_manifest_json(episode: &panshi_character_episode::GoldenEpisode) -> String {
    use std::fmt::Write as _;
    let mut out = String::new();
    out.push_str("{\n  \"fixtureId\": \"v5-character-episode-001\",\n  \"sealed\": true,\n  \"events\": [\n");
    for (index, event) in episode.events.iter().enumerate() {
        let _ = writeln!(
            out,
            "    {{ \"index\": {index}, \"eventType\": \"{}\", \"streamType\": \"{}\", \"streamIdHex\": \"{}\", \"payloadSha256\": \"{}\", \"file\": \"{:02}-{}.pb\" }}{}",
            event.event_type,
            event.stream_type,
            hex(&event.stream_id),
            hex(&event.payload_digest),
            index,
            event.event_type,
            if index + 1 == episode.events.len() { "" } else { "," }
        );
    }
    out.push_str("  ]\n}\n");
    out
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
