import axios, { AxiosError } from 'axios';

import { loggerService } from '../utils/logger';
import config from '../config';

class PowerAppsService {
  // Send data to PowerApps endpoint with retry logic
  public static async sendToPowerApps(
    eventData: any,
  ): Promise<{ success: boolean; error?: string }> {
    if (!config.powerApps.pageProofApprovedEndpoint) {
      const error = 'PowerApps endpoint is not defined.';
      loggerService.logger.error(error);
      return { success: false, error };
    }

    for (let attempt = 1; attempt <= config.powerApps.retryAttempts; attempt++) {
      try {
        const response = await axios.post(config.powerApps.pageProofApprovedEndpoint, eventData, {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: config.powerApps.timeout,
        });

        loggerService.logger.info('Successfully sent to PowerApps:', {
          attempt,
          statusCode: response.status,
          data: response.data,
        });

        return { success: true };
      } catch (error) {
        const isLastAttempt = attempt === config.powerApps.retryAttempts;

        if (isLastAttempt) {
          PowerAppsService.handleError(error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
          };
        }

        loggerService.logger.warn(
          `PowerApps request failed, retrying... (attempt ${attempt}/${config.powerApps.retryAttempts})`,
          {
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        );

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, config.powerApps.retryDelay * attempt));
      }
    }

    return { success: false, error: 'All retry attempts failed' };
  }

  // Handle error when sending data to PowerApps
  private static handleError(error: unknown): void {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      loggerService.logger.error(
        'Axios error while sending to PowerApps:',
        axiosError.response?.data || axiosError.message,
      );
    } else {
      loggerService.logger.error('Unexpected error while sending to PowerApps:', error);
    }
  }
}

export { PowerAppsService };
