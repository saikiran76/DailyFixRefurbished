import { store } from '@/store/store';

export const getState = () => store.getState();

export const getUserId = () => getState().auth.session?.user?.id;
