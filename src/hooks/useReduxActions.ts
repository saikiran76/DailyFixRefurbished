import { useDispatch, useSelector } from 'react-redux';
import type { TypedUseSelectorHook } from 'react-redux';
import type { RootState, AppDispatch } from '@/store/store';

/**
 * Custom hook for typed Redux dispatch
 * Use this hook throughout the app instead of plain `useDispatch`
 */
export const useAppDispatch = () => useDispatch<AppDispatch>();

/**
 * Custom hook for typed Redux selector
 * Use this hook throughout the app instead of plain `useSelector`
 */
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector; 