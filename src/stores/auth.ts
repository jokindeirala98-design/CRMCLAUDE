import { create } from 'zustand'
import type { UserProfile } from '@/types/database'

interface AuthState {
  user: UserProfile | null
  loading: boolean
  setUser: (user: UserProfile | null) => void
  setLoading: (loading: boolean) => void
  isAdmin: () => boolean
  hasPermission: (perm: string) => boolean
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
  isAdmin: () => get().user?.role === 'admin',
  hasPermission: (perm) => {
    const user = get().user
    if (!user) return false
    if (user.role === 'admin') return true
    return user.permissions?.[perm] === true
  },
}))
