#import <AppKit/AppKit.h>
#import <ImageIO/ImageIO.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSString *root = argc > 1 ? [NSString stringWithUTF8String:argv[1]] : NSFileManager.defaultManager.currentDirectoryPath;
    NSString *source = [root stringByAppendingPathComponent:@"tools/data/portrait-source"];
    NSString *destination = [root stringByAppendingPathComponent:@"public/player-portraits"];
    NSString *idFile = [root stringByAppendingPathComponent:@"src/data/portraitAtlasIds.ts"];
    NSString *contents = [NSString stringWithContentsOfFile:idFile encoding:NSUTF8StringEncoding error:nil];
    NSRegularExpression *idPattern = [NSRegularExpression regularExpressionWithPattern:@"\"(\\d+)\"" options:0 error:nil];
    NSMutableArray<NSString *> *expectedIds = [NSMutableArray array];
    for (NSTextCheckingResult *match in [idPattern matchesInString:contents options:0 range:NSMakeRange(0, contents.length)]) {
      [expectedIds addObject:[contents substringWithRange:[match rangeAtIndex:1]]];
    }
    NSRegularExpression *filePattern = [NSRegularExpression regularExpressionWithPattern:@"^nba-(\\d+)\\.png$" options:0 error:nil];
    NSArray<NSString *> *allFiles = [NSFileManager.defaultManager contentsOfDirectoryAtPath:source error:nil];
    NSMutableArray<NSString *> *files = [NSMutableArray array];
    for (NSString *file in allFiles) {
      if ([filePattern firstMatchInString:file options:0 range:NSMakeRange(0, file.length)]) [files addObject:file];
    }
    [files sortUsingComparator:^NSComparisonResult(NSString *left, NSString *right) {
      return [[left substringWithRange:NSMakeRange(4, left.length - 8)] compare:[right substringWithRange:NSMakeRange(4, right.length - 8)] options:NSNumericSearch];
    }];
    if (files.count != expectedIds.count) { NSLog(@"Source count does not match atlas mapping"); return 1; }
    for (NSUInteger index = 0; index < files.count; index++) {
      if (![[files[index] substringWithRange:NSMakeRange(4, files[index].length - 8)] isEqualToString:expectedIds[index]]) {
        NSLog(@"Atlas source order mismatch at %lu", (unsigned long)index); return 1;
      }
    }
    const NSInteger tile = 80;
    const NSInteger columns = 25;
    for (NSInteger row = 0; row < (files.count + columns - 1) / columns; row++) {
      CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
      CGContextRef context = CGBitmapContextCreate(NULL, columns * tile, tile, 8, 0, colorSpace, kCGImageAlphaNoneSkipLast | kCGBitmapByteOrder32Big);
      CGColorSpaceRelease(colorSpace);
      if (!context) { NSLog(@"Cannot create atlas strip"); return 1; }
      CGContextSetRGBFillColor(context, 0, 0, 0, 1);
      CGContextFillRect(context, CGRectMake(0, 0, columns * tile, tile));
      for (NSInteger column = 0; column < MIN(columns, files.count - row * columns); column++) {
        NSString *path = [source stringByAppendingPathComponent:files[row * columns + column]];
        CGImageSourceRef reader = CGImageSourceCreateWithURL((__bridge CFURLRef)[NSURL fileURLWithPath:path], NULL);
        CGImageRef picture = reader ? CGImageSourceCreateImageAtIndex(reader, 0, NULL) : NULL;
        if (!picture) { NSLog(@"Cannot read portrait: %@", path); return 1; }
        CGFloat width = CGImageGetWidth(picture), height = CGImageGetHeight(picture);
        CGFloat scale = tile / MIN(width, height);
        CGContextSaveGState(context);
        CGContextClipToRect(context, CGRectMake(column * tile, 0, tile, tile));
        CGContextDrawImage(context, CGRectMake(column * tile + (tile - width * scale) / 2,
                                              (tile - height * scale) / 2, width * scale, height * scale), picture);
        CGContextRestoreGState(context);
        CGImageRelease(picture);
        CFRelease(reader);
      }
      if (row == 12) {
        unsigned char *bytes = CGBitmapContextGetData(context);
        NSUInteger pixel = (30 * columns * tile + 22 * tile + 40) * 4;
        if (bytes[pixel] + bytes[pixel + 1] + bytes[pixel + 2] < 50) {
          NSLog(@"Max Christie tile is still black"); return 1;
        }
      }
      CGImageRef output = CGBitmapContextCreateImage(context);
      CGContextRelease(context);
      NSString *target = [destination stringByAppendingPathComponent:[NSString stringWithFormat:@"nba-atlas-%03ld.jpg", (long)row]];
      CGImageDestinationRef writer = CGImageDestinationCreateWithURL((__bridge CFURLRef)[NSURL fileURLWithPath:target], CFSTR("public.jpeg"), 1, NULL);
      if (!writer) { NSLog(@"Cannot write atlas: %@", target); return 1; }
      CGImageDestinationAddImage(writer, output, (__bridge CFDictionaryRef)@{ (id)kCGImageDestinationLossyCompressionQuality: @0.88 });
      BOOL written = CGImageDestinationFinalize(writer);
      CFRelease(writer);
      CGImageRelease(output);
      if (!written) { NSLog(@"Cannot write atlas: %@", target); return 1; }
    }
    NSLog(@"Rebuilt %lu portraits into %lu strips", (unsigned long)files.count, (unsigned long)((files.count + columns - 1) / columns));
    return 0;
  }
}
