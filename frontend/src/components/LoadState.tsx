import { errorMessage } from '../lib/domain';
import { Button, EmptyState } from './ui';
export function Loading() { return <p role="status" className="px-5 py-12 text-center text-sm text-[#737b68]">Загружаем…</p>; }
export function LoadError({ error, retry }: { error: unknown; retry: () => void }) {
  return <div role="alert"><EmptyState title="Не удалось загрузить данные" text={errorMessage(error)}><Button tone="light" onClick={retry}>Попробовать снова</Button></EmptyState></div>;
}
