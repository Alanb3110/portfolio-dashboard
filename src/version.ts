export const APP_VERSION = '5.2.2';

const configuredBuildSha = import.meta.env.VITE_BUILD_SHA?.trim();

export const APP_BUILD_ID = configuredBuildSha ? configuredBuildSha.slice(0, 7) : 'local';
export const APP_VERSION_LABEL = `Portfolio Dashboard v${APP_VERSION} · build ${APP_BUILD_ID}`;
