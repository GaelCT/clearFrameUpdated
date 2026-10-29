import { dismissToast, useToasts } from '../../state/toastStore';
import { Icon } from './Icon';

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="toasts" role="region" aria-label="Notifications">
      <div aria-live="polite" aria-relevant="additions">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
            <div className="toast__body">
              <strong>{t.title}</strong>
              {t.message && <p>{t.message}</p>}
            </div>
            <button type="button" className="icon-btn" aria-label="Dismiss notification" onClick={() => dismissToast(t.id)}>
              <Icon name="x" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
