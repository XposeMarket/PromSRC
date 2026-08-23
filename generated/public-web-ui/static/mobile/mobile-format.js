export function formatMobileChatTime(value) {
  try {
    const date = new Date(Number(value || Date.now()));
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const period = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${String(minutes).padStart(2, '0')} ${period}`;
  } catch {
    return '';
  }
}

export function formatMobileTimeAgo(value) {
  if (!value) return 'Never';
  const delta = Date.now() - value;
  if (delta < 0) return new Date(value).toLocaleString();
  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString();
}
