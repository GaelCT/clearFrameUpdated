import { useUi } from '../state/uiStore';
import { Dialog } from './components/Dialog';
import { SHORTCUTS } from './review/useReviewShortcuts';

export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  return (
    <Dialog open={open} title="Keyboard shortcuts" onClose={() => useUi.setState({ shortcutsOpen: false })}>
      <p className="muted">Available in the review workspace when you are not typing in a field.</p>
      <table className="shortcuts">
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.keys}>
              <th scope="row">
                <kbd>{s.keys}</kbd>
              </th>
              <td>{s.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
