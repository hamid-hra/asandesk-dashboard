// «ارسال بازخورد» مثل برنامهٔ دسکتاپ (flutter/lib/asandesk/feedback.dart): دسته، متن، شمارهٔ تماس، تا ۳ تصویر و
// لاگ برنامه. همان API کلاینت‌ها؛ بازخورد در بخش «بازخوردها»ی پنل با کد این کاربر وب دیده می‌شود.
import { useRef, useState } from 'react';
import { Icon } from '../icons';
import { t, useLang } from '../i18n';
import { AsanSpinner } from '../loader';
import { prepareImage, type Telemetry } from '../telemetry';
import { useTheme } from '../theme';
import { DialogTitle, Modal } from '../ui';

const MAX_IMAGES = 3;
type Category = 'bug' | 'idea' | 'other';

export function FeedbackDialog({ telemetry, contact: initialContact, onClose }: { telemetry: Telemetry; contact: string; onClose: () => void }) {
  const lang = useLang();
  const theme = useTheme();
  const [category, setCategory] = useState<Category>('bug');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState(initialContact);
  const [images, setImages] = useState<{ name: string; mime: string; data: string }[]>([]);
  const [attachLog, setAttachLog] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addImages = async (files: FileList | null) => {
    if (!files) return;
    setError('');
    const room = MAX_IMAGES - images.length;
    if (files.length > room) setError(t('asan_feedback_images_max', MAX_IMAGES));
    const picked: typeof images = [];
    for (const f of [...files].slice(0, Math.max(0, room))) {
      const img = await prepareImage(f);
      if (img) picked.push(img);
      else setError(t('asan_feedback_image_bad'));
    }
    setImages((list) => [...list, ...picked].slice(0, MAX_IMAGES));
  };

  const send = async () => {
    if (message.trim().length < 5) {
      setError(t('asan_feedback_too_short'));
      return;
    }
    setBusy(true);
    setError('');
    const r = await telemetry.feedback({ category, message: message.trim(), contact: contact.trim(), attachLog, images, lang, theme });
    setBusy(false);
    if (r.code !== undefined) setDone(r.code);
    else setError(r.error && r.error.startsWith('asan_') ? t(r.error) : r.error || t('asan_feedback_failed'));
  };

  if (done !== null) {
    return (
      <Modal onClose={onClose} width={420}>
        <DialogTitle icon="check">{t('asan_feedback_title')}</DialogTitle>
        <div className="alert ok">{t('asan_feedback_thanks')}</div>
        {done && <p className="ltr" style={{ textAlign: 'center' }}>{t('asan_feedback_ticket', done)}</p>}
        <div className="row">
          <button className="btn primary" onClick={onClose} autoFocus>
            {t('ok')}
          </button>
        </div>
      </Modal>
    );
  }

  const cats: [Category, string, string][] = [
    ['bug', 'bug', t('asan_feedback_cat_bug')],
    ['idea', 'star', t('asan_feedback_cat_idea')],
    ['other', 'chat', t('asan_feedback_cat_contact')],
  ];
  return (
    <Modal onClose={busy ? undefined : onClose} width={520}>
      <DialogTitle icon="chat">{t('asan_feedback_title')}</DialogTitle>
      <p>{t('asan_feedback_sub')}</p>
      <div className="fb-cats">
        {cats.map(([id, icon, label]) => (
          <button key={id} className={category === id ? 'on' : ''} onClick={() => setCategory(id)}>
            <Icon name={icon} size={16} />
            {label}
          </button>
        ))}
      </div>
      <textarea
        className="input fb-text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={t('asan_feedback_msg_hint')}
        maxLength={4000}
        autoFocus
      />
      <div className="field">
        <label>{t('asan_feedback_contact')}</label>
        <input className="input ltr" dir="ltr" inputMode="tel" value={contact} onChange={(e) => setContact(e.target.value)} placeholder={t('asan_feedback_contact_hint')} maxLength={120} />
      </div>
      <div className="fb-images">
        {images.map((img, i) => (
          <div key={i} className="fb-thumb">
            <img src={`data:${img.mime};base64,${img.data}`} alt={img.name} />
            <button onClick={() => setImages((list) => list.filter((_, j) => j !== i))} aria-label={t('asan_feedback_image_remove')}>
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
        {images.length < MAX_IMAGES && (
          <button className="fb-add" onClick={() => fileRef.current?.click()}>
            <Icon name="image" size={20} />
            {t('asan_feedback_add_image')}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void addImages(e.target.files).then(() => (e.target.value = ''))} />
      </div>
      <span className="hint" style={{ fontSize: 12, color: 'var(--muted2)' }}>{t('asan_feedback_images_count', images.length, MAX_IMAGES)}</span>
      <label className="check">
        <input type="checkbox" checked={attachLog} onChange={(e) => setAttachLog(e.target.checked)} />
        {t('asan_feedback_attach_log')}
      </label>
      <span style={{ fontSize: 12, color: 'var(--muted2)', marginTop: -8 }}>{t('asan_feedback_log_info')}</span>
      {error && <div className="alert bad">{error}</div>}
      <div className="row">
        <button className="btn" onClick={onClose} disabled={busy}>
          {t('cancel')}
        </button>
        <button className="btn primary" onClick={send} disabled={busy}>
          {busy ? <AsanSpinner /> : <Icon name="send" />}
          {busy ? t('asan_feedback_sending') : t('asan_feedback_send')}
        </button>
      </div>
    </Modal>
  );
}
