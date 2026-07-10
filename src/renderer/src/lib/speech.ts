export function getVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices();
}

export function speak(text: string, voiceUri?: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  stop();
  const utter = new SpeechSynthesisUtterance(text);
  if (voiceUri) {
    const voice = getVoices().find((v) => v.voiceURI === voiceUri);
    if (voice) utter.voice = voice;
  }
  utter.rate = 1;
  utter.pitch = 1;
  window.speechSynthesis.speak(utter);
}

export function stop(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
}

export function isSpeaking(): boolean {
  if (typeof window === 'undefined' || !window.speechSynthesis) return false;
  return window.speechSynthesis.speaking;
}
