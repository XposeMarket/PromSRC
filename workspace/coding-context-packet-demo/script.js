document.getElementById('year').textContent = new Date().getFullYear();

document.querySelector('[data-scroll-to]').addEventListener('click', () => {
  document.getElementById('proof').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
