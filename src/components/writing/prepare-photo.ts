/** 원본 resizeToJpeg 계약: 긴 변 최대 1600px, 확대 없이 JPEG 품질 0.85로 변환. */
export async function preparePhoto(file:File):Promise<File>{
 if(file.size>10*1024*1024)throw new Error('사진은 10MB 이하만 올릴 수 있습니다.');
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('JPG, PNG, WEBP 사진만 올릴 수 있습니다.');
 let bitmap:ImageBitmap;
 try{bitmap=await createImageBitmap(file);}catch{throw new Error('사진을 읽을 수 없습니다. 다른 사진을 선택해주세요.');}
 try{
  const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const context=canvas.getContext('2d');
  if(!context)throw new Error('사진을 최적화할 수 없습니다. 다시 시도해주세요.');
  context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('사진을 최적화하지 못했습니다.')),'image/jpeg',0.85));
  return new File([blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:blob.type,lastModified:file.lastModified});
 }finally{bitmap.close();}
}
