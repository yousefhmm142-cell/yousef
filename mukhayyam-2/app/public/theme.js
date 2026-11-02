// Paint the saved theme before the app loads, so there is no white flash at night.
(function () {
  var t = null
  try { t = localStorage.getItem('m2-theme') } catch (e) {}
  if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  document.documentElement.dataset.theme = t
  // The reader's own text size and font, before the first paint.
  var size = null, font = null
  try { size = localStorage.getItem('m2-size'); font = localStorage.getItem('m2-font') } catch (e) {}
  if (size) document.documentElement.dataset.size = size
  if (font) document.documentElement.dataset.font = font
})()
