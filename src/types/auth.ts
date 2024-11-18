export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  createdAt: number;
  lastLogin: number;
  status: 'online' | 'offline' | 'away';
  emailVerified: boolean;
  settings: {
    theme: {
      mode: 'light' | 'dark';
      primary: string;
      secondary: string;
    };
    language: string;
    notifications: {
      enabled: boolean;
      volume: number;
    };
  };
}