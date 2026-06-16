// Troca de abas
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.panel').forEach((p) => {
      p.classList.toggle('active', p.id === `tab-${tab}`);
    });
  });
});

// Link "Abrir no Datadog"
fetch('/api/config')
  .then((r) => r.json())
  .then((cfg) => {
    if (cfg.dashboardUrl) {
      const a = document.getElementById('btn-datadog');
      a.href = cfg.dashboardUrl;
      a.classList.remove('hidden');
    }
  })
  .catch(() => {});
