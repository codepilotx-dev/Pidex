# FunASR / SenseVoice notices

CodePilotX can download the following pinned, checksum-verified artifacts on
Windows x64 to provide local speech-to-text. The artifacts are not embedded in
the CodePilotX source tree or installer.

- QwenAudio SenseVoice FunASR llama.cpp runtime v0.1.9
  - Source: https://github.com/QwenAudio/SenseVoice
  - Release: https://github.com/QwenAudio/SenseVoice/releases/tag/runtime-llamacpp-v0.1.9
  - License: MIT. See `LICENSE-SENSEVOICE.txt`.
- llama.cpp / ggml runtime components
  - Source: https://github.com/ggml-org/llama.cpp
  - License: MIT. See `LICENSE-LLAMACPP.txt`.
- miniaudio, used by the downloaded runtime for audio decoding
  - Source: https://github.com/mackron/miniaudio
  - License choice used here: MIT No Attribution. See `LICENSE-MINIAUDIO.txt`.
- SenseVoiceSmall Q8 GGUF and FSMN-VAD GGUF weights
  - Sources: https://huggingface.co/FunAudioLLM/SenseVoiceSmall-GGUF and
    https://huggingface.co/FunAudioLLM/fsmn-vad-GGUF
  - The upstream model cards identify these repositories as Apache-2.0.
    See `LICENSE-APACHE-2.0.txt`.

SenseVoice and FunASR are names of their respective upstream projects. Their
use here does not imply endorsement of CodePilotX by the upstream authors.
