import assert from "node:assert";

void (async () => {
  // ---- Mock ALL browser speech API globals ----
  class MockUtterance {
    constructor(public text: string) {}
    voice: SpeechSynthesisVoice | null = null;
    rate = 1;
    pitch = 1;
  }
  const mockVoices = [
    { voiceURI: "mock-voice-1", name: "Mock 1", lang: "en-US", localService: true, default: true } as SpeechSynthesisVoice,
    { voiceURI: "mock-voice-2", name: "Mock 2", lang: "en-GB", localService: false, default: false } as SpeechSynthesisVoice,
  ];
  let _speaking = false;
  let _lastUtterance: any = undefined;
  const mockSynth = {
    getVoices: () => mockVoices,
    speak: (_u: MockUtterance) => { _speaking = true; _lastUtterance = _u; },
    cancel: () => { _speaking = false; _lastUtterance = undefined; },
    get speaking() { return _speaking; },
  };
  Object.defineProperty(globalThis, "window", {
    value: { speechSynthesis: mockSynth },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
    value: MockUtterance,
    configurable: true,
    writable: true,
  });

  const { getVoices, speak, stop, isSpeaking } = await import("./speech");

  // getVoices
  assert.deepEqual(getVoices(), mockVoices, "getVoices returns mock voices array");

  // speak: rate=1, pitch=1, selects voice by URI
  speak("hello world", "mock-voice-2");
  const u: any = _lastUtterance;
  assert.equal(u.text, "hello world", "text set correctly");
  assert.equal(u.rate, 1, "rate=1");
  assert.equal(u.pitch, 1, "pitch=1");
  assert.equal(u.voice?.voiceURI, "mock-voice-2", "voice selected by URI");
  assert.equal(_speaking, true, "speaking=true after speak()");

  // speak with unknown URI: no crash, voice undefined
  speak("hello", "nonexistent");
  assert.equal(_lastUtterance.voice, undefined, "unknown URI leaves voice undefined");

  // stop
  stop();
  assert.equal(_lastUtterance, null, "stop clears utterance");
  assert.equal(_speaking, false, "stop clears speaking flag");

  // isSpeaking
  _speaking = true;
  assert.equal(isSpeaking(), true);
  _speaking = false;
  assert.equal(isSpeaking(), false);

  console.log("speech.test.ts — all assertions passed");
})();
