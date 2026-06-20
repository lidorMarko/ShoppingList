import api from './api';
import type { Profile } from '../types/index';

const INVITE_CODE_KEY = 'pending_invite_code';

export function storePendingInviteCode(code: string) {
  localStorage.setItem(INVITE_CODE_KEY, code);
}

export async function fetchProfile(): Promise<Profile> {
  const inviteCode = localStorage.getItem(INVITE_CODE_KEY);
  const params = inviteCode ? { inviteCode } : {};
  const profile: Profile = await api.get('/auth/me', { params }).then((r) => r.data);
  localStorage.removeItem(INVITE_CODE_KEY);
  return profile;
}
