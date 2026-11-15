export type PrivateEvent={id:string;title:string;location:string;starts_on:string;ends_on:string};
export type PrivateRoom={id:string;event_id:string;hotel_name:string;room_type:string;total_qty:number;rate:number};
export type PrivateGuest={id:string;event_id:string;name:string;email:string;phone:string;status:'invited'|'confirmed'|'declined'};
export type WorkspaceState={ok:boolean;message:string};
export function parsePrivateGuest(form:FormData):{value:{name:string;email:string;phone:string;status:'invited'|'confirmed'|'declined'};error:null}|{value:null;error:string}{
 const name=form.get('name'),email=form.get('email'),phone=form.get('phone'),status=form.get('status');
 if(typeof name!=='string'||!name.trim()||name.trim().length>120)return {value:null,error:'Enter a guest name of up to 120 characters.'};
 if(typeof email!=='string'||email.trim().length>254||(email.trim()&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())))return {value:null,error:'Enter a valid email address or leave it empty.'};
 if(typeof phone!=='string'||phone.trim().length>40||(phone.trim()&&!/^[+\d() .-]+$/.test(phone.trim())))return {value:null,error:'Enter a valid phone number or leave it empty.'};
 if(status!=='invited'&&status!=='confirmed'&&status!=='declined')return {value:null,error:'Select a valid guest status.'};
 return {value:{name:name.trim(),email:email.trim(),phone:phone.trim(),status},error:null};
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validWorkspaceId(value:FormDataEntryValue|null):value is string{return typeof value==='string'&&uuid.test(value)}
export function parsePrivateRoom(form:FormData):{value:{hotel_name:string;room_type:string;total_qty:number;rate:number};error:null}|{value:null;error:string}{
 const hotel=form.get('hotel_name'),type=form.get('room_type'),quantity=form.get('total_qty'),rate=form.get('rate');
 if(typeof hotel!=='string'||!hotel.trim()||hotel.trim().length>120||typeof type!=='string'||!type.trim()||type.trim().length>120)return {value:null,error:'Enter a hotel and room type of up to 120 characters.'};
 if(typeof quantity!=='string'||!/^\d+$/.test(quantity)||Number(quantity)<1||Number(quantity)>10000)return {value:null,error:'Enter a whole-number room quantity between 1 and 10,000.'};
 if(typeof rate!=='string'||!/^\d+(\.\d{1,2})?$/.test(rate)||Number(rate)>10000000)return {value:null,error:'Enter a rate between ₹0 and ₹1,00,00,000 with at most two decimal places.'};
 return {value:{hotel_name:hotel.trim(),room_type:type.trim(),total_qty:Number(quantity),rate:Number(rate)},error:null};
}
