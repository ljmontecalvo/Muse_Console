const savedTheme = localStorage.getItem('museTheme');
if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.dataset.theme = savedTheme;
