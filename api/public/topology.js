(function () {
  const el = document.getElementById('topology');
  if (!el) return;

  const node = (label, color) =>
    `<span class="px-2 py-0.5 rounded border border-gray-700 ${color}">${label}</span>`;
  const arrow = '<span class="text-gray-600">→</span>';

  let active = 0;

  function render() {
    const dot = active > 0
      ? '<span class="pulse-dot w-2 h-2 rounded-full bg-dd-green inline-block"></span>'
      : '<span class="w-2 h-2 rounded-full bg-gray-700 inline-block"></span>';
    el.innerHTML = [
      dot,
      node('Browser', 'text-gray-300'),
      arrow,
      node('api-vendas', 'text-purple-300'),
      arrow,
      node('worker', 'text-blue-300'),
      '<span class="text-gray-700">|</span>',
      node('postgres', 'text-green-300'),
    ].join(' ');
  }

  document.addEventListener('dd:run-start', () => { active++; render(); });
  document.addEventListener('dd:run-stop', () => { active = Math.max(0, active - 1); render(); });
  render();
})();
