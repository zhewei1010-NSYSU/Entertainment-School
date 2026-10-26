import React from 'react';
import { createRoot } from 'react-dom/client';
import CloudWorkspace from '../app/cloud-workspace';
import PwaStatus from '../app/pwa-status';
import '../app/globals.css';
createRoot(document.getElementById('root')!).render(<><CloudWorkspace/><PwaStatus/></>);
