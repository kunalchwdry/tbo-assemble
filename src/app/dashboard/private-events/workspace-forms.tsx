'use client';
import {useActionState} from 'react';
import {saveEvent,deleteEvent,saveRoom,deleteRoom,saveGuest,deleteGuest} from './actions';
import type {PrivateEvent,PrivateRoom,PrivateGuest,WorkspaceState} from '@/lib/private-event-workspace';
const initial:WorkspaceState={ok:false,message:''};
const field='mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';
const button='inline-flex min-h-10 items-center justify-center rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
const minor='inline-flex min-h-9 items-center justify-center rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50';
function Message({state}:{state:WorkspaceState}){return state.message?<p role={state.ok?'status':'alert'} className={`mt-3 text-sm ${state.ok?'text-emerald-700 dark:text-emerald-400':'text-red-700 dark:text-red-400'}`}>{state.message}</p>:null}
export function EventForm({event}:{event?:PrivateEvent}){
 const [state,action,pending]=useActionState(saveEvent,initial);const prefix=event?.id??'new';
 return <form action={action} className="space-y-3">{event&&<input type="hidden" name="id" value={event.id}/>}
  <label htmlFor={`title-${prefix}`} className="block text-sm font-medium">Event name<input id={`title-${prefix}`} name="title" className={field} defaultValue={event?.title} required maxLength={120}/></label>
  <label htmlFor={`location-${prefix}`} className="block text-sm font-medium">Location<input id={`location-${prefix}`} name="location" className={field} defaultValue={event?.location} maxLength={120}/></label>
  <div className="grid gap-3 sm:grid-cols-2"><label htmlFor={`start-${prefix}`} className="block text-sm font-medium">Start date<input id={`start-${prefix}`} name="starts_on" type="date" className={field} defaultValue={event?.starts_on} required min="1900-01-01" max="2100-12-31"/></label><label htmlFor={`end-${prefix}`} className="block text-sm font-medium">End date<input id={`end-${prefix}`} name="ends_on" type="date" className={field} defaultValue={event?.ends_on} required min="1900-01-01" max="2100-12-31"/></label></div>
  <button className={button} disabled={pending}>{pending?'Saving…':event?'Save event changes':'Create private event'}</button><Message state={state}/>
 </form>;
}
export function EventDelete({event}:{event:PrivateEvent}){const [state,action,pending]=useActionState(deleteEvent,initial);return <form action={action} onSubmit={e=>{if(!window.confirm(`Delete “${event.title}” and all its private room blocks and guests? This cannot be undone.`))e.preventDefault()}}><input type="hidden" name="id" value={event.id}/><button className={minor} disabled={pending}>{pending?'Deleting…':'Delete event'}</button><Message state={state}/></form>}
export function RoomForm({eventId,room}:{eventId:string;room?:PrivateRoom}){
 const [state,action,pending]=useActionState(saveRoom,initial);const prefix=room?.id??eventId;
 return <form action={action} className="space-y-3"><input type="hidden" name="event_id" value={eventId}/>{room&&<input type="hidden" name="id" value={room.id}/>}
 <div className="grid gap-3 sm:grid-cols-2"><label htmlFor={`hotel-${prefix}`} className="block text-sm font-medium">Hotel<input id={`hotel-${prefix}`} name="hotel_name" className={field} defaultValue={room?.hotel_name} required maxLength={120}/></label><label htmlFor={`room-${prefix}`} className="block text-sm font-medium">Room type<input id={`room-${prefix}`} name="room_type" className={field} defaultValue={room?.room_type} required maxLength={120}/></label><label htmlFor={`qty-${prefix}`} className="block text-sm font-medium">Quantity<input id={`qty-${prefix}`} name="total_qty" type="number" min="1" max="10000" step="1" className={field} defaultValue={room?.total_qty} required/></label><label htmlFor={`rate-${prefix}`} className="block text-sm font-medium">Rate per room · INR<input id={`rate-${prefix}`} name="rate" type="number" min="0" max="10000000" step="0.01" className={field} defaultValue={room?.rate} required/></label></div>
 <button className={button} disabled={pending}>{pending?'Saving…':room?'Save room changes':'Add room block'}</button><Message state={state}/>
 </form>;
}
export function RoomDelete({room}:{room:PrivateRoom}){const [state,action,pending]=useActionState(deleteRoom,initial);return <form action={action} onSubmit={e=>{if(!window.confirm(`Delete ${room.room_type} at ${room.hotel_name}?`))e.preventDefault()}}><input type="hidden" name="id" value={room.id}/><input type="hidden" name="event_id" value={room.event_id}/><button className={minor} disabled={pending}>{pending?'Deleting…':'Delete room block'}</button><Message state={state}/></form>}
export function GuestForm({eventId,guest}:{eventId:string;guest?:PrivateGuest}){
 const [state,action,pending]=useActionState(saveGuest,initial);const prefix=guest?.id??eventId;
 return <form action={action} className="space-y-3"><input type="hidden" name="event_id" value={eventId}/>{guest&&<input type="hidden" name="id" value={guest.id}/>}
 <div className="grid gap-3 sm:grid-cols-2"><label htmlFor={`guest-name-${prefix}`} className="block text-sm font-medium">Name<input id={`guest-name-${prefix}`} name="name" className={field} defaultValue={guest?.name} required maxLength={120}/></label><label htmlFor={`guest-email-${prefix}`} className="block text-sm font-medium">Email (optional)<input id={`guest-email-${prefix}`} name="email" type="email" className={field} defaultValue={guest?.email??''} maxLength={254}/></label><label htmlFor={`guest-phone-${prefix}`} className="block text-sm font-medium">Phone (optional)<input id={`guest-phone-${prefix}`} name="phone" type="tel" className={field} defaultValue={guest?.phone??''} maxLength={40}/></label><label htmlFor={`guest-status-${prefix}`} className="block text-sm font-medium">Status<select id={`guest-status-${prefix}`} name="status" className={field} defaultValue={guest?.status??'invited'}><option value="invited">Invited</option><option value="confirmed">Confirmed</option><option value="declined">Declined</option></select></label></div>
 <button className={button} disabled={pending}>{pending?'Saving…':guest?'Save guest changes':'Add guest'}</button><Message state={state}/>
 </form>;
}
export function GuestDelete({guest}:{guest:PrivateGuest}){const [state,action,pending]=useActionState(deleteGuest,initial);return <form action={action} onSubmit={e=>{if(!window.confirm(`Delete “${guest.name}” from this private event?`))e.preventDefault()}}><input type="hidden" name="id" value={guest.id}/><input type="hidden" name="event_id" value={guest.event_id}/><button className={minor} disabled={pending}>{pending?'Deleting…':'Delete guest'}</button><Message state={state}/></form>}
