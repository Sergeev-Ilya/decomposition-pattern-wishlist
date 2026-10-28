import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../data/mock';
import { Brand, focus, Icon } from './ui';
export default function PublicLayout({ children }: { children: ReactNode }) {
  const { userId } = useStore();
  return <div className="min-h-screen bg-[#f8f8f0]"><header className="mx-auto flex max-w-[1150px] items-center justify-between gap-4 border-b border-[#e1e5d6] px-5 py-6 sm:px-9"><Brand /><Link to={userId ? '/wishlists' : '/register'} className={`inline-flex items-center gap-2 rounded text-xs text-[#6d7d56] ${focus}`}>{userId ? 'Мои вишлисты' : 'Создать свой'}<Icon name="arrow" className="h-4 w-4" /></Link></header>{children}<footer className="mx-auto mt-14 flex max-w-[1150px] flex-wrap items-center justify-between gap-3 border-t border-[#e1e5d6] px-5 py-7 text-[11px] text-[#929c82] sm:px-9"><span>Wishlist · Подарки, которые радуют</span><span className="inline-flex items-center gap-1.5"><Icon name="heart" className="h-3.5 w-3.5" />Больше маленьких радостей</span></footer></div>;
}
