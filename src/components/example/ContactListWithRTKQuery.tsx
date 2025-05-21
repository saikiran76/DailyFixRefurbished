import React from 'react';
import { useGetContactsQuery } from '../../services/apiService';

/**
 * Example component that demonstrates how to use RTK Query
 * This shows how to fetch contacts using the RTK Query hooks
 */
const ContactListWithRTKQuery: React.FC = () => {
  // Use the automatically generated hook from our API service
  const {
    data: contacts,
    isLoading,
    isError,
    error,
    refetch
  } = useGetContactsQuery();

  // Handle loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-4">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-blue-500"></div>
        <p className="text-gray-400 mt-2">Loading contacts...</p>
      </div>
    );
  }

  // Handle error state
  if (isError) {
    return (
      <div className="bg-red-500 bg-opacity-10 text-red-400 p-4 rounded-md">
        <h3 className="font-semibold mb-2">Error loading contacts</h3>
        <p>{error?.toString() || 'Unknown error occurred'}</p>
        <button 
          onClick={() => refetch()} 
          className="mt-2 px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
        >
          Try Again
        </button>
      </div>
    );
  }

  // Render the contacts
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Contacts</h2>
        <button 
          onClick={() => refetch()} 
          className="px-3 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600"
        >
          Refresh
        </button>
      </div>

      {contacts && contacts.length > 0 ? (
        <ul className="space-y-2">
          {contacts.map((contact) => (
            <li 
              key={contact.id} 
              className="p-3 bg-gray-800 rounded-lg hover:bg-gray-700 cursor-pointer"
            >
              <div className="flex items-center">
                <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center">
                  {contact.name?.charAt(0) || '?'}
                </div>
                <div className="ml-3">
                  <h3 className="font-medium">{contact.name}</h3>
                  <p className="text-sm text-gray-400">{contact.lastMessage || 'No messages'}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="p-4 bg-gray-800 rounded-lg text-center">
          <p className="text-gray-400">No contacts found</p>
        </div>
      )}
    </div>
  );
};

export default ContactListWithRTKQuery; 