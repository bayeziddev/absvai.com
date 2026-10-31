// "Write a review" (product and landing pages): sends the review; it shows after the shop approves it.
import { api } from './app.js';

document.querySelectorAll('[data-review-form]').forEach(form => {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = form.querySelector('[data-msg]');
    const button = form.querySelector('button[type=submit]');
    const body = {
      productId: Number(form.dataset.product), rating: Number(form.querySelector('input[name=rating]:checked')?.value || 5),
      name: form.name.value.trim(), phone: form.phone.value.trim(), body: form.body.value.trim(), website: form.website.value,
    };
    if (body.name.length < 2) { msg.className = 'form-msg error'; msg.textContent = 'Type your name.'; form.name.focus(); return; }
    if (body.body.length < 5) { msg.className = 'form-msg error'; msg.textContent = 'Write a few words about the product.'; form.body.focus(); return; }
    button.disabled = true;
    try {
      const r = await api('/api/reviews', body);
      form.innerHTML = `<p class="notice">${r.message}</p>`;
    } catch (err) {
      msg.className = 'form-msg error';
      msg.textContent = err.message;
      button.disabled = false;
    }
  });
});
