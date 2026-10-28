import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import PublicLayout from '../components/PublicLayout';
import { EmptyState, secondaryClass } from '../components/ui';
export default function NotFoundPage() {
  const { user } = useAuth();
  return <PublicLayout><main className="mx-auto max-w-xl px-5 py-20"><EmptyState title="Кажется, это не тот адрес" text="Такой страницы нет. Зато ваши желания по-прежнему на своем месте." icon="sparkle"><Link to={user ? '/wishlists' : '/'} className={secondaryClass}>{user ? 'К моим вишлистам' : 'На главную'}</Link></EmptyState></main></PublicLayout>;
}
