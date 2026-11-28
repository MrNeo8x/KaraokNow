import { Global, Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { ObjectStorageService } from './object-storage.service';

@Global()
@Module({ controllers: [FilesController], providers: [ObjectStorageService], exports: [ObjectStorageService] })
export class StorageModule {}
