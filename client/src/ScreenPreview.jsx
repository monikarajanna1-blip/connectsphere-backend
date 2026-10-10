import { useEffect, useRef } from 'react';

// Shows the screen I am sharing inside the app, so the presenter sees
// the same window everyone else sees (not their own face).
// Pass "large" to fill the meeting area; without it, a small box is shown.
function ScreenPreview({ track, large }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    el.srcObject = new MediaStream([track]);
    el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, [track]);

  if (!track) return null;

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      style={{
        width: large ? '100%' : 'min(480px, 90%)',
        maxWidth: large ? 1200 : undefined,
        height: large ? '60vh' : undefined,
        maxHeight: large ? undefined : '40vh',
        objectFit: 'contain',
        background: '#000',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.15)',
      }}
    />
  );
}

export default ScreenPreview;