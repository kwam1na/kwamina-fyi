(() => {
  const sectionNav = document.querySelector('.rail-nav[aria-label="On this page"]');

  if (!sectionNav) return;

  const sectionLinks = [...sectionNav.querySelectorAll('a[href^="#"]')];
  const indicator = sectionNav.querySelector('.rail-indicator');
  const sections = sectionLinks
    .map((link) => document.getElementById(link.hash.slice(1)))
    .filter(Boolean);

  const setCurrentSection = () => {
    const readingLine = window.innerHeight * 0.35;
    let currentSection = sections[0];

    sections.forEach((section) => {
      if (section.getBoundingClientRect().top <= readingLine) currentSection = section;
    });

    let activeLink;
    sectionLinks.forEach((link) => {
      const isCurrent = link.hash === `#${currentSection.id}`;
      if (isCurrent) {
        link.setAttribute('aria-current', 'location');
        activeLink = link;
      } else {
        link.removeAttribute('aria-current');
      }
    });

    if (indicator && activeLink) {
      const indicatorOffset = activeLink.offsetTop + (activeLink.offsetHeight - 16) / 2;
      indicator.style.transform = `translate3d(0, ${indicatorOffset}px, 0)`;
      indicator.style.opacity = '1';
    }
  };

  let scrollFrame;
  window.addEventListener('scroll', () => {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(setCurrentSection);
  }, { passive: true });
  window.addEventListener('hashchange', setCurrentSection);
  setCurrentSection();
})();
