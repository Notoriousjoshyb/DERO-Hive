const status = document.getElementById('status');
navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
  stream.getTracks().forEach((track) => track.stop());
  status.textContent = 'Microphone enabled — you can dictate in the side panel now.';
  status.className = 'ok';
  setTimeout(() => window.close(), 1600);
}).catch(() => {
  status.textContent = 'Microphone was blocked. Click the mic icon in the address bar to allow it, then reload this page.';
  status.className = 'err';
});
