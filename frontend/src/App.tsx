import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Loading, LoadError } from './components/LoadState';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import WishlistsPage from './pages/WishlistsPage';
import WishlistPage from './pages/WishlistPage';
import SharedWishlistPage from './pages/SharedWishlistPage';
import ReservationPage from './pages/ReservationPage';
import NotFoundPage from './pages/NotFoundPage';
function Protected({ children }: { children: ReactNode }) {
  const auth = useAuth(); const location = useLocation();
  if (auth.status === 'loading') return <Loading />;
  if (auth.status === 'error') return <LoadError error={auth.error} retry={auth.refresh} />;
  return auth.user ? children : <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`} replace />;
}
export default function App() {
  const location = useLocation();
  useEffect(() => { window.scrollTo({ top: 0 }); document.title = 'Wishlist — для того, что радует'; }, [location.pathname]);
  return <Routes><Route path="/" element={<HomePage />} /><Route path="/login" element={<LoginPage />} /><Route path="/register" element={<RegisterPage />} /><Route path="/wishlists" element={<Protected><WishlistsPage /></Protected>} /><Route path="/wishlists/:wishlistId" element={<Protected><WishlistPage /></Protected>} /><Route path="/s/:shareToken" element={<SharedWishlistPage />} /><Route path="/r/:reservationToken" element={<ReservationPage />} /><Route path="*" element={<NotFoundPage />} /></Routes>;
}
