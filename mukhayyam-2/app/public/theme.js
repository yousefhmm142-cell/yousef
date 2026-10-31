// Paint the saved theme before the app loads, so there is no white flash at night.
(function () {
  var t = null
  try { t = localStorage.getItem('m2-theme') } catch (e) {}
  if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  document.documentElement.dataset.theme = t
})()
