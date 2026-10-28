import { useState, type FormEvent } from 'react';
import { ownerApi, type Gift, type WishlistSummary } from '../api';
import { useAuth } from '../auth/AuthContext';
import { errorMessage, isStatus, parsePrice, priceInput } from '../lib/domain';
import { Button, ErrorMessage, Field, inputClass, Modal } from './ui';

export function WishlistForm({ wishlist, onClose, onSaved }: { wishlist?: WishlistSummary; onClose: () => void; onSaved: () => Promise<void> }) {
  const { expire } = useAuth(); const [pending, setPending] = useState(false);
  const [title, setTitle] = useState(wishlist?.title || ''); const [description, setDescription] = useState(wishlist?.description || ''); const [error, setError] = useState('');
  async function submit(e: FormEvent) { e.preventDefault(); if (pending) return; setPending(true); setError(''); try { if (!title.trim()) throw new Error('Добавьте название списка.'); const body = { title: title.trim(), description: description.trim() }; await (wishlist ? ownerApi.update(wishlist.id, body) : ownerApi.create(body)); await onSaved(); onClose(); } catch (e) { if (isStatus(e, 401)) expire(); setError(errorMessage(e)); } finally { setPending(false); } }
  return <Modal title={wishlist ? 'Изменить вишлист' : 'Новый вишлист'} onClose={onClose} busy={pending}><form onSubmit={submit} className="space-y-5"><fieldset disabled={pending} className="contents"><Field label="Название" required><input autoFocus required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="Например, мой день рождения" className={inputClass} /></Field><Field label="Описание"><textarea maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} placeholder="Пара слов для тех, кто хочет вас порадовать" rows={3} className={`${inputClass} resize-y`} /></Field><ErrorMessage>{error}</ErrorMessage><div className="flex flex-wrap justify-end gap-3 pt-2"><Button tone="light" onClick={onClose}>Отмена</Button><Button type="submit" tone="yellow">{pending ? 'Сохраняем…' : wishlist ? 'Сохранить' : 'Создать вишлист'}</Button></div></fieldset></form></Modal>;
}
export function GiftForm({ wishlistId, gift, onClose, onSaved }: { wishlistId: string; gift?: Gift; onClose: () => void; onSaved: () => Promise<void> }) {
  const { expire } = useAuth(); const [pending, setPending] = useState(false);
  const [values, setValues] = useState({ title: gift?.title || '', price: gift ? priceInput(gift.priceKopecks) : '', url: gift?.url || '', note: gift?.note || '' }); const [error, setError] = useState('');
  function change(key: keyof typeof values, value: string) { setValues({ ...values, [key]: value }); }
  async function submit(e: FormEvent) {
    e.preventDefault(); if (pending) return; setPending(true); setError('');
    try {
      if (!values.title.trim()) throw new Error('Добавьте название подарка.');
      const priceKopecks = parsePrice(values.price); const url = values.url.trim();
      if (url) { try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw Error(); } catch { throw new Error('Укажите абсолютную HTTP(S)-ссылку без логина и пароля.'); } }
      const body = { title: values.title.trim(), priceKopecks, url, note: values.note.trim() };
      await (gift ? ownerApi.updateGift(wishlistId, gift.id, body) : ownerApi.createGift(wishlistId, body)); await onSaved(); onClose();
    } catch (e) { if (isStatus(e, 401)) expire(); setError(errorMessage(e)); } finally { setPending(false); }
  }
  return <Modal title={gift ? 'Изменить желание' : 'Еще одно желание'} onClose={onClose} wide busy={pending}><form onSubmit={submit} className="space-y-5"><fieldset disabled={pending} className="contents"><Field label="Название подарка" required><input autoFocus required maxLength={200} value={values.title} onChange={e => change('title', e.target.value)} placeholder="О чем вы мечтаете?" className={inputClass} /></Field><Field label="Цена, ₽" required><input required inputMode="decimal" value={values.price} onChange={e => change('price', e.target.value)} placeholder="0" className={inputClass} /></Field><Field label="Ссылка на подарок"><input type="url" maxLength={4096} value={values.url} onChange={e => change('url', e.target.value)} placeholder="https://" className={inputClass} /></Field><Field label="Заметка"><textarea maxLength={2000} rows={3} value={values.note} onChange={e => change('note', e.target.value)} placeholder="Цвет, размер или что-то важное" className={`${inputClass} resize-y`} /></Field><ErrorMessage>{error}</ErrorMessage><div className="flex flex-wrap justify-end gap-3 pt-1"><Button tone="light" onClick={onClose}>Отмена</Button><Button tone="yellow" type="submit">{pending ? 'Сохраняем…' : gift ? 'Сохранить' : 'Добавить желание'}</Button></div></fieldset></form></Modal>;
}
export function Confirm({ title, text, action, onConfirm, onClose, danger = false }: { title: string; text: string; action: string; onConfirm: () => Promise<void>; onClose: () => void; danger?: boolean }) {
  const { expire } = useAuth(); const [pending, setPending] = useState(false); const [error, setError] = useState('');
  async function confirm() { if (pending) return; setPending(true); setError(''); try { await onConfirm(); onClose(); } catch (e) { if (isStatus(e, 401)) expire(); setError(errorMessage(e)); } finally { setPending(false); } }
  return <Modal title={title} onClose={onClose} busy={pending}><p className="text-sm leading-6 text-[#727969]">{text}</p><ErrorMessage>{error}</ErrorMessage><div className="mt-7 flex flex-wrap justify-end gap-3"><Button tone="light" disabled={pending} onClick={onClose}>Не сейчас</Button><Button tone={danger ? 'danger' : 'yellow'} onClick={confirm} disabled={pending}>{pending ? 'Секунду…' : action}</Button></div></Modal>;
}
