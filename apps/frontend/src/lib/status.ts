export function getStatusVariant(status: string) {
  switch (status) {
    case 'open':
      return 'success';
    case 'claimed':
    case 'worker_selected':
    case 'pending_approval':
      return 'warning';
    case 'accepted':
    case 'completed':
      return 'blue';
    case 'expired':
    case 'disputed':
      return 'error';
    default:
      return 'default';
  }
}
