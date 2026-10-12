import '@fontsource-variable/space-grotesk';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './about.css';

// Match the theme the visitor picked in the app.
try {
  const saved = JSON.parse(localStorage.getItem('timeboard3d.v1') ?? '{}') as { theme?: string };
  if (saved.theme === 'cream') document.documentElement.dataset.theme = 'cream';
} catch {
  /* storage unavailable */
}

// Fade sections in as they scroll into view.
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('seen');
        io.unobserve(e.target);
      }
    }
  },
  { rootMargin: '0px 0px -10% 0px' },
);
document.querySelectorAll('.block').forEach((el) => io.observe(el));
