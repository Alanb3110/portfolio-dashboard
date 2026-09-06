import './main';

void Promise.all([
  import('./overview-ui'),
  import('./history-chart-ui'),
  import('./allocation-ui'),
  import('./rebalancing-ui'),
]).catch((error) => {
  console.error('Portfolio Dashboard UI extension bootstrap failed.', error);
});
