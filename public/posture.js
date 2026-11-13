export function standingBadge(step) {
  if (step?.posture !== 'standing') return null;
  const badge = document.createElement('span'); badge.className = 'posture-badge';
  const icon = document.createElement('img'); icon.src = '/standing.svg'; icon.alt = ''; icon.setAttribute('aria-hidden', 'true');
  badge.append(icon, document.createTextNode('Standing'));
  return badge;
}
export function renderPosture(container, step) {
  const standing = step?.posture === 'standing';
  if (container.dataset.posture === String(standing)) return;
  container.dataset.posture = String(standing);
  const badge = standingBadge(step); container.replaceChildren(...(badge ? [badge] : [])); container.hidden = !standing;
}
