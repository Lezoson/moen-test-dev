import path from 'path';
import { promises as fs } from 'fs';

import express from 'express';
import cors from 'cors';
import createError from 'http-errors';
import cookieParser from 'cookie-parser';
import logger from 'morgan';
import { default as PageProof } from '@pageproof/sdk';
import { default as NodeRequestAdapter } from '@pageproof/sdk/lib/adapters/NodeRequestAdapter';
import { default as WorkerThreadsCryptoAdapter } from '@pageproof/sdk/lib/adapters/WorkerThreadsCryptoAdapter';
import dotenv from 'dotenv';

export {
  express,
  cors,
  createError,
  cookieParser,
  logger,
  path,
  PageProof,
  NodeRequestAdapter,
  WorkerThreadsCryptoAdapter,
  fs,
  dotenv,
};
