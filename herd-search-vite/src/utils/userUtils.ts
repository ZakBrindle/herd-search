/**
 * Utility functions for user-related data
 */

/**
 * Returns a robust avatar URL with fallbacks.
 * Uses ui-avatars.com for a personalized placeholder if no photo exists or if it fails to load.
 */
export const getAvatarUrl = (photoURL: string | null | undefined, displayName?: string): string => {
    if (photoURL && photoURL.startsWith('http')) {
        return photoURL;
    }
    const name = displayName || 'User';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff&size=128`;
};
