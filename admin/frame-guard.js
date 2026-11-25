// 被別的網站用 iframe 嵌入時不顯示（防止點擊劫持）
if (window.top !== window.self) {
  document.documentElement.classList.add('framed');
  try { window.top.location = window.self.location.href; } catch (e) { /* 跨網域時只隱藏 */ }
}
