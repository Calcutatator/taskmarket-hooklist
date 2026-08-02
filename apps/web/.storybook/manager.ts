import { addons } from 'storybook/manager-api';
import { create } from 'storybook/theming/create';

addons.setConfig({
  theme: create({
    base: 'dark',
    brandTitle: 'Taskmarket component library',
    brandUrl: '/',
    colorPrimary: '#cc667f',
    colorSecondary: '#82b5a9',
  }),
});
