// admin/reports.js - reported listings: Open and Done tabs; Hide the product (the kit's ConfirmButton) or Dismiss.
// Refreshes every 5 seconds.

const reportsMessage = document.getElementById('message');
let reportsTab = 'open';

// Loads the reports in the current tab and draws them.
async function loadReports() {
  try {
    const data = await api('GET', '/api/admin/reports?tab=' + reportsTab);
    clearLoadProblem(reportsMessage);
    setNavBadge('/admin/reports.html', data.open_count, 'open reports');
    if (!dataChanged('reports', data)) return;
    document.getElementById('tabs').replaceChildren(...['open', 'done'].map((tab) => {
      const tabButton = make('button', tab === reportsTab ? 'tab active' : 'tab', tab === 'open' ? `Open (${data.open_count})` : 'Done');
      tabButton.type = 'button';
      tabButton.addEventListener('click', () => { reportsTab = tab; forgetDrawnData('reports'); loadReports(); });
      return tabButton;
    }));
    document.getElementById('report-list').replaceChildren(...data.reports.map(reportCard));
    document.getElementById('no-reports').classList.toggle('hidden', data.reports.length > 0);
  } catch (error) {
    if (!goToLoginIfNeeded(error)) showLoadProblem(reportsMessage, error);
  }
}

// One report: product, shop, time, reason, and Hide the product (ConfirmButton) or Dismiss while open.
function reportCard(report) {
  const card = make('article', 'card');
  card.append(make('h2', '', `${report.product_name} · ${report.shop_name}`));
  card.append(make('p', 'small muted', `Reported ${formatDateTime(report.created_at)}${report.status !== 'open' ? ' · ' + (report.status === 'hidden' ? 'product hidden' : 'dismissed') : ''}`));
  card.append(make('p', 'description', report.reason));
  if (report.status === 'open') {
    const row = make('div', 'actions');
    const hide = make('span');
    mountKit(hide, IK.ConfirmButton, { label: 'Hide the product', confirmLabel: 'Hide product?', hint: 'Press again to hide this product from customers', onConfirm: () => reportAction(report.id, 'hide') });
    const dismiss = make('button', 'secondary', 'Dismiss');
    dismiss.type = 'button';
    dismiss.addEventListener('click', () => reportAction(report.id, 'dismiss'));
    row.append(hide, dismiss);
    card.append(row);
  }
  return card;
}

// Sends Hide or Dismiss for one report, then draws the list again.
async function reportAction(id, action) {
  try {
    const answer = await api('POST', `/api/admin/reports/${id}/${action}`);
    showMessage(reportsMessage, answer.message, 'ok');
    forgetDrawnData('reports');
    loadReports();
  } catch (error) {
    showMessage(reportsMessage, error.message, 'error');
  }
}

refreshEvery5Seconds(loadReports);
