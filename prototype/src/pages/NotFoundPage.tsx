import { Link } from 'react-router-dom';
import { useStore } from '../data/mock';
import PublicLayout from '../components/PublicLayout';
import { EmptyState, secondaryClass } from '../components/ui';
export default function NotFoundPage() {
  const { userId } = useStore();
  return <PublicLayout><main className="mx-auto max-w-xl px-5 py-20"><EmptyState title="Кажется, это не тот адрес" text="Такой страницы нет. Зато ваши желания по-прежнему на своем месте." icon="sparkle"><Link to={userId ? '/wishlists' : '/'} className={secondaryClass}>{userId ? 'К моим вишлистам' : 'На главную'}</Link></EmptyState></main></PublicLayout>;
}
