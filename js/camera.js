// The in-app live camera. Needs HTTPS and the user's permission; the stream never leaves the phone.

let stream = null;

export function cameraSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext !== false;
}

/** Start the back camera in a <video> element. Rejects if permission is refused. */
export async function startCamera(video) {
  stopCamera(video);
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  const track = stream.getVideoTracks()[0];
  // Keep refocusing on whatever the camera points at, where the phone supports it.
  if (track?.getCapabilities?.().focusMode?.includes('continuous')) {
    track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
  }
  video.srcObject = stream;
  if (!video.videoWidth) await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }));
  await video.play().catch(() => {});
}

export function stopCamera(video) {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  if (video) video.srcObject = null;
}

export function torchSupported() {
  return Boolean(stream?.getVideoTracks()[0]?.getCapabilities?.().torch);
}

export async function setTorch(on) {
  await stream?.getVideoTracks()[0]?.applyConstraints({ advanced: [{ torch: on }] });
}

/** Copy the current video frame onto a canvas, no bigger than maxSide pixels on its long side. */
export function grabFrame(video, canvas, maxSide) {
  const { videoWidth: w, videoHeight: h } = video;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}
