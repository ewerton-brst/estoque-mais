// Ícones
lucide.createIcons();

// Barra de progresso de rolagem
const progressBar = document.getElementById('progress-bar');
const updateProgress = () => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    progressBar.style.width = `${scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0}%`;
};
window.addEventListener('scroll', updateProgress, { passive: true });
updateProgress();

// Revelação suave ao rolar
const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (entry.isIntersecting) { entry.target.classList.add('visible'); revealObserver.unobserve(entry.target); }
    });
}, { threshold: 0.14 });
document.querySelectorAll('.reveal').forEach((element) => revealObserver.observe(element));

// Contadores animados
const animateCount = (element) => {
    const target = Number(element.dataset.count || 0);
    const suffix = element.dataset.suffix || '';
    const duration = 1400;
    const start = performance.now();
    const step = (now) => {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        element.textContent = Math.round(target * eased).toLocaleString('pt-BR') + suffix;
        if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
};
const countObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (entry.isIntersecting) { animateCount(entry.target); countObserver.unobserve(entry.target); }
    });
}, { threshold: 0.6 });
document.querySelectorAll('[data-count]').forEach((element) => countObserver.observe(element));

// Menu mobile
const navToggle = document.getElementById('nav-toggle');
const navLinks = document.getElementById('nav-links');
navToggle?.addEventListener('click', () => navLinks.classList.toggle('open'));
navLinks?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => navLinks.classList.remove('open')));

// Link ativo conforme a seção visível
const sections = ['inicio', 'servicos', 'estoque-mais', 'contato'].map((id) => document.getElementById(id));
const navAnchors = [...navLinks.querySelectorAll('a[href^="#"]')];
const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navAnchors.forEach((anchor) => anchor.classList.toggle('active', anchor.getAttribute('href') === `#${entry.target.id}`));
    });
}, { rootMargin: '-40% 0px -55% 0px' });
sections.forEach((section) => section && sectionObserver.observe(section));

// Acordeão da ajuda: abre um tópico por vez (opcional e suave)
const accordionItems = [...document.querySelectorAll('.accordion details')];
accordionItems.forEach((item) => item.addEventListener('toggle', () => {
    if (!item.open) return;
    accordionItems.forEach((other) => { if (other !== item) other.open = false; });
}));